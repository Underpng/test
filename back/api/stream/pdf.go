package stream

import (
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

func PDFStreamHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		pathParam := c.Query("path")
		if pathParam == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing 'path' parameter"})
			return
		}

		decodedPath := pathParam

		if !strings.HasPrefix(pathParam, "/") {
			var err error
			decodedPath, err = url.PathUnescape(pathParam)
			if err != nil {
				c.Status(http.StatusBadRequest)
				return
			}
		}

		rawPath := strings.TrimPrefix(decodedPath, "/")
		filePath := filepath.Join("/books", rawPath)

		if _, err := os.Stat(filePath); err != nil {
			if os.IsNotExist(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			}
			return
		}

		c.Header("Content-Type", "application/pdf")
		c.Header("Accept-Ranges", "bytes")
		c.File(filePath)
	}
}
