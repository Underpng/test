type Props = {
    src: string;
    size?: "sm" | "md" | "lg";
    className?: string;
};

const sizes = {
    sm: "w-16",
    md: "w-32 md:w-36",
    lg: "w-44 md:w-52",
};

// Decorative mascot picture; the surrounding text carries the meaning.
export function Illustration({ src, size = "lg", className = "" }: Props) {
    return (
        <img
            src={src}
            alt=""
            aria-hidden
            draggable={false}
            className={`aspect-square flex-shrink-0 rounded-3xl object-cover shadow-md animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none ${sizes[size]} ${className}`}
        />
    );
}
