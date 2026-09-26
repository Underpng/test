type Props = {
    src: string;
    size?: "sm" | "md" | "lg";
    className?: string;
};

// Pixel art is 128x128: keep displayed sizes at whole multiples so every
// dot stays square (x2/x3 on phones, x1/x2 on desktops).
const sizes = {
    sm: "w-16",
    md: "w-32",
    lg: "w-32 md:w-64",
};

// Decorative mascot picture; the surrounding text carries the meaning.
export function Illustration({ src, size = "lg", className = "" }: Props) {
    return (
        <img
            src={src}
            alt=""
            aria-hidden
            draggable={false}
            className={`aspect-square flex-shrink-0 rounded-3xl object-cover shadow-md [image-rendering:pixelated] animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none ${sizes[size]} ${className}`}
        />
    );
}
