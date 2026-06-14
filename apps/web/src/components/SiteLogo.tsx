import Link from "next/link";
import clsx from "clsx";

type SiteLogoProps = {
  href?: string;
  ariaLabel?: string;
  className?: string;
  imageClassName?: string;
};

export function SiteLogo({
  href = "/",
  ariaLabel = "Home",
  className,
  imageClassName,
}: SiteLogoProps) {
  const classes = clsx("inline-flex items-center hover:opacity-95 transition-opacity", className);

  return (
    <Link href={href} className={classes} aria-label={ariaLabel}>
      <img
        src="/brand/lotus.svg"
        alt=""
        className={clsx(
          "block w-auto h-12 sm:h-14 md:h-16 max-w-[140px] sm:max-w-[180px] md:max-w-[240px]",
          imageClassName
        )}
      />
    </Link>
  );
}
