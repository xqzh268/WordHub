// 仅供 latex-ipc-e2e 使用的假 Tectonic，按主文件里的标记模拟结果。
// 只有 WORDHUB_MOCK=1 且设置 WORDHUB_TECTONIC_PATH 指向本脚本时，应用才会用它。
//   %FAKE-FAIL            退出码 1
//   %FAKE-DIAGNOSTICS <相对路径>  报告主文件警告和指定子文件错误后退出
//   %FAKE-SLOW            挂起 30 秒（用于测试停止与取代）
//   %FAKE-READ <绝对路径>  输出 Tectonic 读取项目外文件时的警告行
//   %FAKE-PDF-TWO-PAGES   生成蓝、绿两页 PDF，默认生成红色单页 PDF
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outIndex = args.indexOf("-o");
const outDir = outIndex >= 0 ? args[outIndex + 1] : process.cwd();
const mainFile = args.at(-1);
const source = readFileSync(mainFile, "utf8");
const stem = path.basename(mainFile, path.extname(mainFile));

const outside = /%FAKE-READ (.+)/u.exec(source)?.[1]?.trim();
if (outside) console.error(`warning: accessing absolute path \`${outside}\``);

function pdfWithColoredPages(colors) {
  const objectIds = colors.map((_, index) => 3 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${objectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${colors.length} >>`,
  ];
  for (const [index, color] of colors.entries()) {
    const content = `${color} rg\n50 50 100 100 re f\n`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents ${objectIds[index] + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  return `${pdf}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
}

const finish = () => {
  const diagnosticFile = /%FAKE-DIAGNOSTICS (.+)/u.exec(source)?.[1]?.trim();
  if (diagnosticFile) {
    console.error(`warning: ${path.basename(mainFile)}:2: Citation undefined`);
    console.error(`error: ${diagnosticFile}:3: Undefined control sequence`);
    process.exit(1);
  }
  if (source.includes("%FAKE-FAIL")) {
    console.error("error: fake engine failure");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const colors = source.includes("%FAKE-PDF-TWO-PAGES")
    ? ["0 0 1", "0 1 0"]
    : ["1 0 0"];
  writeFileSync(path.join(outDir, `${stem}.pdf`), pdfWithColoredPages(colors));
  writeFileSync(path.join(outDir, `${stem}.log`), "fake log\n");
  console.log("note: fake engine finished");
  process.exit(0);
};

if (source.includes("%FAKE-SLOW")) setTimeout(finish, 30_000);
else finish();
