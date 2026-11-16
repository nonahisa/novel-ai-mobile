import { describe, expect, it } from "vitest";
import { GITHUB_CLIENT_ID, pickGithubClientId } from "../src/app/githubScreen";

describe("GitHub の Client ID", () => {
  it("端末では作者の OAuth App のもの（Ov で始まる20字）", () => {
    expect(GITHUB_CLIENT_ID).toMatch(/^Ov[0-9A-Za-z]{18}$/);
    expect(pickGithubClientId(true, "Ov-e2e")).toBe(GITHUB_CLIENT_ID);
  });
  it("ブラウザでは試験が差し込んだものだけ。無ければ空（［サインイン］は未）", () => {
    expect(pickGithubClientId(false, "Ov-e2e")).toBe("Ov-e2e");
    expect(pickGithubClientId(false, undefined)).toBe("");
    expect(pickGithubClientId(false, 42)).toBe("");
  });
});
