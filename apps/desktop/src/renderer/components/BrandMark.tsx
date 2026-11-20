import { useId } from "react";

// 文枢标志（小尺寸版：加粗、无拖尾），几何同 docs/design/logo-v4/seal-small.svg。
// 印面用 --accent，随亮暗主题变色；字为镂空，透出标题栏底色。
const SEAL =
  "M12 8H102L112 18V108A4 4 0 0 1 108 112H12A4 4 0 0 1 8 108V12A4 4 0 0 1 12 8Z";
const GLYPH =
  "M21 42H87C90 41.4 93 39.6 95.2 37.4L100.6 43.6C101.1 44.2 100.9 45.2 100 45.7C98.8 46.5 97.2 47 95.4 47H21Z" +
  "M71.5 44H81.5C81.5 70 68 92 19 103.8C58 90 71.5 72 71.5 44Z" +
  "M39.5 44H46C48 64 62 81.5 84 90.4C92 93.6 98.5 96.4 106.5 98.8C98 100.4 90 101.6 82 101.4C74 101.2 43 84 39.5 44Z" +
  "M57 17h7v18h-7Z";

export function BrandMark({ size = 22 }: { size?: number }) {
  const mask = `wh-brand-${useId().replace(/:/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="8 8 104 104"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      <defs>
        <mask
          id={mask}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="120"
          height="120"
        >
          <rect width="120" height="120" fill="#fff" />
          <path
            d={GLYPH}
            fill="#000"
            stroke="#000"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <path d={SEAL} fill="var(--accent)" mask={`url(#${mask})`} />
    </svg>
  );
}
