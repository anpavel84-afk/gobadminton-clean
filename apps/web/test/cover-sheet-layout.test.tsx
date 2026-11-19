import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const editorSource = readFileSync(join(root, "src/components/consumer/players/CoverEditor.tsx"), "utf8");
const cssSource = readFileSync(join(root, "src/styles/players.css"), "utf8");

describe("cover sheet layout (#607 #608 template 22)", () => {
  it("orders dialog body: hint → preview → caption → choose → sliders → statuses → footer", () => {
    expect(editorSource).toContain('className="profile-dialog--cover"');
    expect(editorSource).toContain('className="profile-cover-editor"');
    expect(editorSource).toContain(
      "Предпросмотр обложки · фрагмент в шапке профиля при текущем размере экрана",
    );
    expect(editorSource).toContain('className="profile-cover-editor__caption"');
    expect(editorSource).toMatch(/disabled=\{!file \|\| saving\}/);

    const stackStart = editorSource.indexOf('className="profile-cover-editor"');
    expect(stackStart).toBeGreaterThan(-1);
    const stack = editorSource.slice(stackStart);
    const order = [
      "JPEG, PNG или WebP",
      'aria-label="Предпросмотр обложки"',
      "ProfileCover",
      "profile-cover-editor__caption",
      "Выбрать изображение",
      "По горизонтали",
      "По вертикали",
      "Готовим фрагмент",
      "profile-form-actions",
      "Сохранить фрагмент",
    ];
    let cursor = 0;
    for (const marker of order) {
      const next = stack.indexOf(marker, cursor);
      expect(next, `expected «${marker}» after previous sheet markers`).toBeGreaterThan(-1);
      cursor = next + marker.length;
    }
  });

  it("keeps fragment preview aria group and always renders position sliders", () => {
    expect(editorSource).toMatch(
      /preview && frameRatio[\s\S]*?aria-label="Предпросмотр обложки"[\s\S]*?: <ProfileCover/,
    );
    expect(editorSource).toContain("По горизонтали");
    expect(editorSource).toContain("По вертикали");
    expect(editorSource).not.toMatch(/\{file && <>[\s\S]*По горизонтали/);
  });

  it("scopes nowrap + flex:1 1 auto footer to the cover dialog, including mobile", () => {
    expect(cssSource).toMatch(
      /\.profile-cover-editor\s*\{[^}]*display\s*:\s*flex[^}]*flex-direction\s*:\s*column[^}]*gap\s*:\s*16px/,
    );
    const coverFooterRule =
      /\.profile-dialog--cover\s+\.profile-form-actions\s*>\s*\.gb-c23-btn[^\{]*\{[^}]*flex\s*:\s*1\s+1\s+auto[^}]*white-space\s*:\s*nowrap/;
    const allFooterRules = cssSource.match(new RegExp(coverFooterRule.source, "g"));
    expect(allFooterRules?.length ?? 0).toBeGreaterThanOrEqual(2);

    const mobileStart = cssSource.indexOf("@media (max-width:720px)");
    expect(mobileStart).toBeGreaterThan(-1);
    const afterMobile = cssSource.slice(mobileStart);
    const nextMedia = afterMobile.indexOf("@media", 1);
    const mobileBlock = nextMedia === -1 ? afterMobile : afterMobile.slice(0, nextMedia);
    expect(mobileBlock).toContain(".fr3 .profile-form-actions > .gb-c23-btn { flex:1; }");
    expect(mobileBlock).toMatch(coverFooterRule);
  });
});
