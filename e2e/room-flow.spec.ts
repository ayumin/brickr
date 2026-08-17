import { expect, test } from "@playwright/test";

const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.ADMIN_PASSWORD ?? "brickr-e2e-password";

test("signed-out feed remains read-only", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "フィード" })).toBeVisible();
  await expect(page.getByRole("button", { name: "投稿する" })).toHaveCount(0);
});

test("signup pre-fills an invite code from the URL", async ({ page }) => {
  await page.goto("/signup?inviteCode=INVITE-FROM-URL");

  await expect(page.getByLabel("招待コード")).toHaveValue("INVITE-FROM-URL");
});

test("admin can sign in, create a room, and publish a post", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(adminEmail);
  await page.getByLabel("パスワード").fill(adminPassword);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "ルーム", exact: true }).click();
  await expect(page.getByRole("heading", { name: "ルーム" })).toBeVisible();

  const roomTitle = `E2E room ${Date.now()}`;
  await page.getByRole("button", { name: "新しいルーム" }).click();
  await page.getByLabel("ルーム名").fill(roomTitle);
  await page.getByRole("button", { name: "作成", exact: true }).click();

  await expect(page.getByRole("heading", { name: roomTitle })).toBeVisible();

  const postContent = `E2E post ${Date.now()}`;
  await page.getByRole("button", { name: /いま何が起きてる/ }).click();
  const composer = page.getByRole("dialog");
  await composer.getByPlaceholder(/いま何が起きてる/).fill(postContent);
  await composer.getByRole("button", { name: "投稿する", exact: true }).click();

  await expect(page.getByText(postContent, { exact: true })).toBeVisible();
});
