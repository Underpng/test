// Command shelf is a single-binary comic and ebook server for the home LAN.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"time"

	"shelf/api"
	"shelf/internal/cover"
	"shelf/internal/db"
	"shelf/internal/library"
	"shelf/internal/saver"
	"shelf/internal/scan"
	"shelf/web"
)

var version = "dev"

type config struct {
	booksDir     string
	dataDir      string
	port         int
	pageSize     int
	coverSize    int
	coverQuality int
	sevenZip     string
	scanInterval time.Duration
	logFile      string
	saver        bool
	saverHeight  int
	saverQuality int
	saverCacheMB int
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	if v, err := strconv.ParseBool(os.Getenv(key)); err == nil {
		return v
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(key)); err == nil {
		return v
	}
	return def
}

// baseDir is where books/ and data/ live by default: next to the
// executable, so a copied folder just works.
func baseDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	dir := filepath.Dir(exe)
	if rel, err := filepath.Rel(os.TempDir(), dir); err == nil && !filepath.IsAbs(rel) && rel != ".." && !hasPrefix(rel, "..") {
		return "." // `go run` builds into a temp dir; use the working directory instead
	}
	return dir
}

func hasPrefix(p, prefix string) bool {
	return len(p) >= len(prefix) && p[:len(prefix)] == prefix
}

func loadConfig() config {
	base := baseDir()
	var c config
	flag.StringVar(&c.booksDir, "books", envOr("BOOKS_DIR", filepath.Join(base, "books")), "directory containing the books")
	flag.StringVar(&c.dataDir, "data", envOr("DATA_DIR", filepath.Join(base, "data")), "directory for the database and covers")
	flag.IntVar(&c.port, "port", envInt("PORT", 50080), "port to listen on")
	flag.IntVar(&c.pageSize, "page-size", envInt("PAGE_SIZE", 20), "books per page in listings")
	flag.IntVar(&c.coverSize, "cover-size", envInt("COVER_SIZE", 300), "cover thumbnail short side in pixels")
	flag.IntVar(&c.coverQuality, "cover-quality", envInt("COVER_QUALITY", 75), "cover JPEG quality")
	flag.StringVar(&c.sevenZip, "7z", envOr("SEVENZIP", ""), "path to the 7-Zip executable (for CBR); auto-detected when empty")
	flag.DurationVar(&c.scanInterval, "scan-interval", envDuration("SCAN_INTERVAL", 10*time.Minute), "how often to look for new books (0 disables)")
	flag.BoolVar(&c.saver, "saver", envBool("SAVER", true), "shrink comic pages for readers outside the home LAN (data saver)")
	flag.IntVar(&c.saverHeight, "saver-height", envInt("SAVER_HEIGHT", 1200), "data saver: page height in pixels")
	flag.IntVar(&c.saverQuality, "saver-quality", envInt("SAVER_QUALITY", 70), "data saver: JPEG quality")
	flag.IntVar(&c.saverCacheMB, "saver-cache-mb", envInt("SAVER_CACHE_MB", 2048), "data saver: disk cache budget in MB")
	flag.StringVar(&c.logFile, "log", envOr("LOG_FILE", ""), "log file path ('-' for console only); default data/server.log")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println("shelf", version)
		os.Exit(0)
	}
	return c
}

func findTool(explicit string, names ...string) string {
	if explicit != "" {
		return explicit
	}
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
}

// consoleWriter ignores write errors: a windowless (-H windowsgui) build
// has no usable stdout, and io.MultiWriter would otherwise stop at it.
type consoleWriter struct{ w io.Writer }

func (c consoleWriter) Write(p []byte) (int, error) {
	c.w.Write(p)
	return len(p), nil
}

func openLog(c config) (*log.Logger, func()) {
	writers := []io.Writer{consoleWriter{os.Stdout}}
	closer := func() {}
	if c.logFile != "-" {
		p := c.logFile
		if p == "" {
			p = filepath.Join(c.dataDir, "server.log")
		}
		if info, err := os.Stat(p); err == nil && info.Size() > 5<<20 {
			os.Rename(p, p+".old")
		}
		if f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
			writers = append(writers, f)
			closer = func() { f.Close() }
		}
	}
	return log.New(io.MultiWriter(writers...), "", log.LstdFlags), closer
}

func lanAddresses() []string {
	var out []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		// Hyper-V / WSL / VPN adapters are not reachable from the phone.
		lower := strings.ToLower(ifc.Name)
		if strings.Contains(lower, "vethernet") || strings.Contains(lower, "virtual") ||
			strings.Contains(lower, "tailscale") || strings.Contains(lower, "nordlynx") {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && ipn.IP.IsPrivate() {
				out = append(out, ipn.IP.String())
			}
		}
	}
	return out
}

func main() {
	c := loadConfig()
	// Not in every OS registry; browsers need it for "add to home screen".
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	if abs, err := filepath.Abs(c.dataDir); err == nil {
		c.dataDir = abs
	}
	// Stay small: a soft heap cap makes the GC work harder when cover
	// generation inflates the heap, instead of holding on to the headroom.
	debug.SetMemoryLimit(96 << 20)
	if err := os.MkdirAll(c.dataDir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "cannot create data dir:", err)
		os.Exit(1)
	}
	logger, closeLog := openLog(c)
	defer closeLog()

	lib, err := library.New(c.booksDir)
	if err != nil {
		logger.Fatalf("books dir: %v", err)
	}
	database, err := db.Open(filepath.Join(c.dataDir, "library.json"))
	if err != nil {
		logger.Fatalf("open db: %v", err)
	}
	defer database.Close()

	sevenZipNames := []string{"7z", "7zz", "7za"}
	if runtime.GOOS == "windows" {
		sevenZipNames = append(sevenZipNames,
			filepath.Join(os.Getenv("ProgramFiles"), "7-Zip", "7z.exe"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "7-Zip", "7z.exe"))
	}
	sevenZip := findTool(c.sevenZip, sevenZipNames...)
	pdfToPpm := findTool("", "pdftoppm")
	pdfInfo := findTool("", "pdfinfo")

	coverDir := filepath.Join(c.dataDir, "covers")
	scanner := &scan.Scanner{
		Lib:      lib,
		DB:       database,
		CoverDir: coverDir,
		Cover:    cover.Options{Size: c.coverSize, Quality: c.coverQuality, SevenZip: sevenZip, PdfToPpm: pdfToPpm},
		PdfInfo:  pdfInfo,
		Log:      logger,
	}
	var pageSaver *saver.Saver
	if c.saver {
		pageSaver, err = saver.New(saver.Options{
			Dir:        filepath.Join(c.dataDir, "saver"),
			MaxHeight:  c.saverHeight,
			Quality:    c.saverQuality,
			MaxBytes:   int64(c.saverCacheMB) << 20,
			Foreground: 2,
			WarmAhead:  true,
			Log:        logger,
		})
		if err != nil {
			logger.Printf("data saver disabled: %v", err)
			pageSaver = nil
		}
	}

	srv := &api.Server{
		Lib:      lib,
		DB:       database,
		Scanner:  scanner,
		CoverDir: coverDir,
		PageSize: c.pageSize,
		SevenZip: sevenZip,
		Saver:    pageSaver,
		Static:   web.Dist(),
		Version:  version,
		Log:      logger,
	}

	logger.Printf("shelf %s  books=%s  data=%s  7z=%q  pdftoppm=%q", version, lib.BooksDir, c.dataDir, sevenZip, pdfToPpm)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		res, err := scanner.Run()
		if err != nil {
			logger.Printf("initial scan failed: %v", err)
			return
		}
		n, _ := database.Count()
		logger.Printf("scan done: %d books (+%d ~%d -%d) in %s", n, res.Added, res.Updated, res.Deleted, res.Duration.Round(time.Millisecond))
		debug.FreeOSMemory()
		scanner.Loop(ctx, c.scanInterval)
	}()

	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", c.port),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		logger.Printf("listening on http://localhost:%d", c.port)
		for _, ip := range lanAddresses() {
			logger.Printf("  LAN: http://%s:%d", ip, c.port)
		}
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatalf("server: %v", err)
		}
	}()

	<-ctx.Done()
	logger.Println("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	httpServer.Shutdown(shutdownCtx)
}
