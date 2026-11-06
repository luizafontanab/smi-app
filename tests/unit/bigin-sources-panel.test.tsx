// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BiginSourcesPanel } from "@/app/console/crm/BiginSourcesPanel";
import { CompaniesBox } from "@/app/console/crm/CompaniesBox";
import type { CompanyListRow } from "@/lib/crm-companies/list";
import type { BiginSourcesRun } from "@/lib/sources/bigin";

vi.mock("@/app/console/crm/actions", () => ({ syncCompaniesNow: vi.fn(), setCompanyMember: vi.fn(), saveCompanyNewsPage: vi.fn(), adoptImportedNewsPage: vi.fn() }));

/* The Bigin sources panel, moved from Story Sources into CRM's Companies box (#51). */

const run = (over: Partial<BiginSourcesRun> = {}): BiginSourcesRun => ({
  at: "2026-11-05T03:00:00Z", complete: true, companies: 12, fromWebsite: 3,
  added: 2, linked: 1, unlinked: 0, paused: 1, skipped: [], membersSet: 0, ...over,
});

describe("BiginSourcesPanel", () => {
  it("says plainly when Bigin isn't connected", () => {
    render(<BiginSourcesPanel live={false} run={null} />);
    expect(screen.getByRole("region", { name: "Story sources from Bigin" })).toHaveTextContent(
      "Bigin isn't connected, so story sources come from the imported list only.",
    );
  });

  it("says when story sources haven't been taken from Bigin yet", () => {
    render(<BiginSourcesPanel live run={null} />);
    expect(screen.getByRole("region", { name: "Story sources from Bigin" })).toHaveTextContent(
      "Not updated from Bigin yet. Sync companies does it while the story crawler is on, and so does the daily sync.",
    );
  });

  it("summarises the last run", () => {
    render(<BiginSourcesPanel live run={run()} />);
    expect(screen.getByRole("region", { name: "Story sources from Bigin" })).toHaveTextContent(
      "Last updated 5 Nov 2026: 12 companies with an address (3 using their Website) — 2 added, 1 linked, 1 paused.",
    );
  });

  it("says a partial run paused nothing", () => {
    render(<BiginSourcesPanel live run={run({ complete: false, paused: 0 })} />);
    expect(screen.getByRole("region", { name: "Story sources from Bigin" })).toHaveTextContent(
      "(Bigin stopped part-way; nothing was paused)",
    );
  });

  it("lists the skipped and clashing addresses to fix in Bigin", () => {
    render(<BiginSourcesPanel live run={run({
      skipped: [
        { company: "Acme", url: "not a url", reason: "invalid_url" },
        { company: "Beta", url: "https://shared.test/news", reason: "clash" },
      ],
    })} />);
    expect(screen.getByText("2 Bigin addresses skipped — fix in Bigin")).toBeInTheDocument();
    expect(screen.getByText(/^Acme:/).closest("li")).toHaveTextContent("Acme: not a url — not a web address");
    expect(screen.getByText(/^Beta:/).closest("li")).toHaveTextContent("Beta: https://shared.test/news — another company already lists this page");
  });

  it("warns when no company had a News Page URL, a likely misnamed field", () => {
    render(<BiginSourcesPanel live run={run({ websiteFallbackWithheld: true, companies: 0, fromWebsite: 0 })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No Bigin company came back with a News Page URL");
  });

  it("raises no warning or skipped list on a clean run", () => {
    render(<BiginSourcesPanel live run={run()} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/skipped — fix in Bigin/)).toBeNull();
  });
});

const company = (over: Partial<CompanyListRow>): CompanyListRow => ({
  id: "u1", biginId: "9100000000001", name: "Acme", website: null, newsPageUrl: "https://acme.test/news", inUse: "news_page",
  lastSyncedAt: "2026-11-06T03:00:00Z", deletedInBiginAt: null, contacts: 0, member: null, memberChosen: false, sourceId: null, pushPending: false, covered: [], ...over,
});
const box = (props: Partial<Parameters<typeof CompaniesBox>[0]>) =>
  render(
    <CompaniesBox
      live list={{ rows: [], count: 0, page: 1, pages: 1 }} q="" filter="all" only={undefined} run={null} sourcesRun={null}
      flash={undefined} error={undefined} href={(over) => `/console/crm?${new URLSearchParams(Object.entries(over).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}#companies`} keep={{}}
      open={null} members={[]} canEditCompanies={false}
      {...props}
    />,
  );

describe("CRM Companies box", () => {
  it("carries the Bigin sources panel", () => {
    box({ sourcesRun: run({ skipped: [{ company: "Acme", url: "nope", reason: "invalid_url" }] }) });
    const companies = screen.getByRole("region", { name: /^Companies/ });
    expect(within(companies).getByRole("region", { name: "Story sources from Bigin" })).toHaveTextContent("1 Bigin address skipped — fix in Bigin");
  });

  it("carries the panel's not-connected state too", () => {
    box({ live: false, list: null });
    expect(screen.getByRole("region", { name: "Story sources from Bigin" })).toHaveTextContent("Bigin isn't connected");
  });

  it("links each company that has a story source to it on Story Sources", () => {
    box({ list: { rows: [company({ sourceId: "src-1" }), company({ id: "u2", biginId: "9100000000002", name: "Nowhere", sourceId: null })], count: 2, page: 1, pages: 1 } });
    const links = screen.getAllByRole("link", { name: "On Story Sources" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/console/sources?view=sources&company=9100000000001");
  });

  it("offers the way back to every company when a Story Sources link narrowed it to one", () => {
    box({ only: "9100000000001", list: { rows: [company({})], count: 1, page: 1, pages: 1 } });
    expect(screen.getByRole("link", { name: "Show all companies" })).toHaveAttribute("href", "/console/crm?#companies");
  });

  it("opens one company panel from the company's name, beside the Story Sources link (#51 + #53 + #54)", () => {
    const acme = company({ sourceId: "src-1", member: { id: "m1", name: "Jo" }, memberChosen: true });
    box({
      only: "9100000000001",
      list: { rows: [acme], count: 1, page: 1, pages: 1 },
      open: {
        id: acme.id, biginId: acme.biginId, name: acme.name, lastSyncedAt: acme.lastSyncedAt, member: acme.member, memberChosen: true,
        rows: [{ apiName: "Phone", label: "Phone", value: "0161 000" }, { apiName: "Machine_Brands", label: "Machine Brands", value: null }],
        website: null, newsPageUrl: acme.newsPageUrl, inUse: "news_page", pushPending: false, covered: [],
      },
      members: [{ id: "m1", name: "Jo" }],
    });
    const row = screen.getByRole("link", { name: "On Story Sources" }).closest("tr")!;
    // one link to the company per row: its name
    const toCompany = within(row).getAllByRole("link").filter((l) => l.getAttribute("href")?.includes("company=u1"));
    expect(toCompany).toHaveLength(1);
    expect(toCompany[0]).toHaveAccessibleName("Acme");
    expect(toCompany[0]).toHaveAttribute("aria-current", "true");
    expect(row).toHaveTextContent("chosen by hand");

    const panel = screen.getByRole("region", { name: "Acme" });
    expect(within(panel).getByRole("combobox", { name: "Member" })).toHaveValue("m1");
    expect(within(panel).getByRole("button", { name: "Use automatic match" })).toBeInTheDocument();
    expect(within(panel).getByText("Phone").nextElementSibling).toHaveTextContent("0161 000");
    expect(within(panel).getByText("Machine Brands").nextElementSibling).toHaveTextContent("—");
    expect(within(panel).getByRole("link", { name: "Close" })).toHaveAttribute("href", "/console/crm?#companies");
  });

  it("opens no panel when no company is selected", () => {
    box({ list: { rows: [company({})], count: 1, page: 1, pages: 1 } });
    expect(screen.queryByRole("combobox", { name: "Member" })).toBeNull();
  });
});

describe("the company editor's News Page URL (issue #55)", () => {
  const acme = {
    id: "u1", biginId: "9100000000001", name: "Acme", lastSyncedAt: "2026-11-06T03:00:00Z", rows: [], member: null, memberChosen: false,
    website: "https://acme.test", newsPageUrl: "https://acme.test/news", inUse: "news_page" as const, pushPending: false, covered: [],
  };

  it("edits the News Page URL in the company's one panel, beside the member and Bigin's fields, showing the Website without a field for it", () => {
    box({ list: { rows: [company({})], count: 1, page: 1, pages: 1 }, open: acme, canEditCompanies: true });
    const field = screen.getByRole("textbox", { name: "News Page URL" });
    expect(field).toBeEnabled();
    expect(field).toHaveValue("https://acme.test/news");
    expect(field.closest("form")!.querySelector("input[name=company]")).toHaveValue("u1");
    expect(screen.getByText(/Website: https:\/\/acme\.test/)).toHaveTextContent("change it in Bigin");
    expect(document.querySelector("input[name=website]")).toBeNull();
    expect(screen.getByRole("button", { name: "Save News Page URL" })).toBeEnabled();
  });

  it("is disabled with \"edit in Bigin for now\" while the token can't write companies", () => {
    box({ open: acme, canEditCompanies: false });
    expect(screen.getByRole("textbox", { name: "News Page URL" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save News Page URL" })).toBeDisabled();
    expect(screen.getByText(/edit in Bigin for now/)).toBeInTheDocument();
  });

  it("shows push pending, in the editor and the list, until Bigin accepts the edit", () => {
    box({ list: { rows: [company({ pushPending: true })], count: 1, page: 1, pages: 1 }, open: { ...acme, pushPending: true }, canEditCompanies: true });
    expect(screen.getByRole("table")).toHaveTextContent("push pending");
    expect(screen.getByText(/Push pending\./).closest("p")).toHaveTextContent("retried automatically");
  });
});

describe("covered by imported list (issue #56)", () => {
  const SOURCES = [
    { id: "s1", url: "https://bright.test/news", label: "Bright news" },
    { id: "s2", url: "https://bright.test/press/", label: null },
  ];
  const bright = {
    id: "u2", biginId: "9100000000002", name: "Bright", lastSyncedAt: "2026-11-06T03:00:00Z", rows: [], member: null, memberChosen: false,
    website: "https://bright.test", newsPageUrl: null, inUse: "website" as const, pushPending: false, covered: SOURCES,
  };

  it("labels a covered company in the list instead of its Website stand-in, and has its own filter", () => {
    box({ list: { rows: [company({ id: "u2", name: "Bright", newsPageUrl: null, website: "https://bright.test", inUse: "website", covered: SOURCES })], count: 1, page: 1, pages: 1 } });
    const row = screen.getByRole("link", { name: "Bright" }).closest("tr")!;
    expect(row).toHaveTextContent("Covered by imported list");
    expect(row).not.toHaveTextContent("Website stand-in");
    expect(screen.getByRole("link", { name: "Covered by imported list" })).toHaveAttribute("href", "/console/crm?cfilter=covered#companies");
  });

  it("lists every covering source in the panel, each with Use as News Page URL", () => {
    box({ open: bright, canEditCompanies: true });
    const buttons = screen.getAllByRole("button", { name: "Use as News Page URL" });
    expect(buttons).toHaveLength(2);
    expect(buttons[0].closest("li")).toHaveTextContent("Bright news · https://bright.test/news");
    expect(buttons[1].closest("li")).toHaveTextContent("https://bright.test/press/");
    const form = buttons[1].closest("form")!;
    expect(form.querySelector("input[name=company]")).toHaveValue("u2");
    expect(form.querySelector("input[name=source]")).toHaveValue("s2");
    expect(buttons[0]).toBeEnabled();
  });

  it("disables Use as News Page URL with \"edit in Bigin for now\" while the token can't write companies", () => {
    box({ open: bright, canEditCompanies: false });
    for (const b of screen.getAllByRole("button", { name: "Use as News Page URL" })) expect(b).toBeDisabled();
    expect(screen.getAllByText(/edit in Bigin for now/).length).toBeGreaterThan(0);
  });

  it("offers nothing for a company that isn't covered", () => {
    box({ open: { ...bright, covered: [] }, canEditCompanies: true });
    expect(screen.queryByRole("button", { name: "Use as News Page URL" })).toBeNull();
  });
});
