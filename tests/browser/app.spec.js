import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const fixture = JSON.parse(
  await readFile(new URL("../fixtures/trending.json", import.meta.url), "utf8"),
);
const items = fixture.results.map((i, n) => ({
  ...i,
  id: 101 + n,
  media_type: n === 1 ? "tv" : "movie",
  genre_ids: [n % 2 ? 18 : 28],
}));
const names = items.map((i) => i.title || i.name);
async function mockCatalog(page) {
  await page.route("**/api.themoviedb.org/3/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    let data = { results: items };
    if (path.includes("/genre/"))
      data = {
        genres: [
          { id: 28, name: "Action" },
          { id: 18, name: "Drama" },
        ],
      };
    else if (path.includes("/search/"))
      data = {
        results: items.filter((i) =>
          (i.title || i.name)
            .toLowerCase()
            .includes(url.searchParams.get("query").toLowerCase()),
        ),
      };
    else if (/\/(movie|tv)\/\d+$/.test(path)) {
      const id = Number(path.split("/").at(-1));
      data = {
        ...items.find((i) => i.id === id),
        genres: [{ id: 18, name: "Drama" }],
        credits: { cast: [{ name: "A performer" }] },
        seasons: [{ season_number: 1 }],
      };
    } else if (path.includes("/season/"))
      data = {
        episodes: [
          { episode_number: 1, name: "The beginning", runtime: 40 },
          { episode_number: 2, name: "Another chapter", runtime: 42 },
        ],
      };
    await route.fulfill({ json: data });
  });
  await page.route("https://cinesrc.st/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><p>Test player</p><script>window.addEventListener('message',e=>{if(e.data.type==='cinesrc:command')window.lastCommand=e.data;});parent.postMessage({type:'cinesrc:ready'},'*');</script></body></html>`,
    }),
  );
}
async function start(page) {
  await mockCatalog(page);
  await page.goto("/");
  await expect(page.locator(".hero")).toBeVisible();
}
test("browse, details, like, list, filters and search work", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await page.locator(".hero [data-action=details]").click();
  await expect(
    page.getByRole("dialog", { name: "Title details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I like this", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "I like this", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Add to My list", exact: true })
    .click();
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "My list", exact: true }).click();
  await expect(page.locator(".grid .title-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await expect(page.locator(".welcome h1")).toHaveText(
    "Big stories. Little escapes.",
  );
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill(names[0]);
  await expect(page.locator(".grid .title-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Close search" }).click();
  await expect(page.locator(".hero")).toBeVisible();
  expect(errors).toEqual([]);
});
test("real player events save progress, survive reload, resume and stay separate by profile", async ({
  page,
}) => {
  await start(page);
  await page.locator(".hero [data-action=play]").click();
  const frame = page.frames().find((f) => f.url().includes("cinesrc.st"));
  await expect
    .poll(() =>
      page
        .frames()
        .find((f) => f.url().includes("cinesrc.st"))
        ?.url(),
    )
    .toContain("cinesrc.st");
  await page
    .locator("#movie-frame")
    .contentFrame()
    .locator("body")
    .evaluate(() =>
      parent.postMessage(
        { type: "cinesrc:timeupdate", currentTime: 450, duration: 1200 },
        "*",
      ),
    );
  await expect(page.locator("#playback-status")).toContainText("7 / 20");
  await page.getByRole("button", { name: "Close player" }).click();
  await expect(
    page.getByRole("heading", { name: "Continue watching" }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "38",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Continue watching" }),
  ).toBeVisible();
  await page.locator("#continue-rows .poster-button").click();
  await expect
    .poll(async () =>
      page
        .locator("#movie-frame")
        .contentFrame()
        .locator("body")
        .evaluate(() => window.lastCommand),
    )
    .toEqual({ type: "cinesrc:command", command: "seek", args: [450] });
  await page.getByRole("button", { name: "Close player" }).click();
  await page.getByRole("button", { name: /Switch profile/ }).click();
  await page.getByRole("button", { name: "Add profile", exact: true }).click();
  await page.getByRole("textbox", { name: "Profile name" }).fill("Codi");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.locator(".profile-tile").filter({ hasText: "Codi" }).click();
  await expect(
    page.getByRole("heading", { name: "Continue watching" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Switch profile/ }).click();
  await page.locator(".profile-tile").filter({ hasText: "You" }).click();
  await expect(
    page.getByRole("heading", { name: "Continue watching" }),
  ).toBeVisible();
});
test("mobile layout does not overflow and auth setup is honest", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page
    .getByRole("button", { name: /Sign in/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".setup-note")).toContainText("being set up");
});
test("completed playback leaves Continue Watching; TV selection uses the right episode", async ({
  page,
}) => {
  await start(page);
  await page.locator(".hero [data-action=play]").click();
  await page
    .locator("#movie-frame")
    .contentFrame()
    .locator("body")
    .evaluate(() => {
      parent.postMessage(
        { type: "cinesrc:timeupdate", currentTime: 1200, duration: 1200 },
        "*",
      );
      parent.postMessage({ type: "cinesrc:ended" }, "*");
    });
  await page.getByRole("button", { name: "Close player" }).click();
  await expect(
    page.getByRole("heading", { name: "Continue watching" }),
  ).toHaveCount(0);
  await page
    .locator('[data-action=details][data-key="tv:102"]')
    .first()
    .click();
  await page.getByRole("button", { name: /2. Another chapter/ }).click();
  await expect(page.locator("#movie-frame")).toHaveAttribute("src", /s=1&e=2/);
});
