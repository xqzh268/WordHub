import type { CSSProperties } from "react";

type SealProps = {
  glyph: string;
  color: string;
  size?: number;
  round?: boolean;
  className?: string;
};

/** 篆刻印章式头像：单字、实色底、内描边。用户为圆形墨点。 */
export function Seal({
  glyph,
  color,
  size = 28,
  round = false,
  className = "",
}: SealProps) {
  const style = {
    "--seal": color,
    "--seal-size": `${size}px`,
  } as CSSProperties;
  return (
    <span
      className={`seal ${round ? "seal-round" : ""} ${className}`}
      style={style}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}
