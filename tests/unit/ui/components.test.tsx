import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/Button";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Sheet } from "@/components/ui/Sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { ToastProvider, useToast } from "@/components/ui/Toast";

describe("ProgressRing", () => {
  it("exposes progressbar semantics and clamps the value", () => {
    render(<ProgressRing value={120} max={50} label="Level progress" />);
    const bar = screen.getByRole("progressbar", { name: "Level progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemax", "50");
  });
});

describe("Button", () => {
  it("defaults to type=button", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("renders its child when asChild", () => {
    render(
      <Button asChild>
        <a href="/today">Today</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Today" })).toHaveClass(
      "rounded-full",
    );
  });
});

describe("Sheet", () => {
  it("opens from its trigger and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Sheet trigger={<Button>Open</Button>} title="Install Questrix">
        <p>Share → Add to Home Screen</p>
      </Sheet>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(
      screen.getByRole("dialog", { name: "Install Questrix" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Tabs", () => {
  it("switches panels", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="following">
        <TabsList aria-label="Feed">
          <TabsTrigger value="following">Following</TabsTrigger>
          <TabsTrigger value="everyone">Everyone</TabsTrigger>
        </TabsList>
        <TabsContent value="following">Posts from friends</TabsContent>
        <TabsContent value="everyone">All posts</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Posts from friends");
    await user.click(screen.getByRole("tab", { name: "Everyone" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("All posts");
  });
});

describe("Toast", () => {
  function Trigger() {
    const toast = useToast();
    return (
      <Button onClick={() => toast({ title: "+20 pts", tone: "success" })}>
        Complete
      </Button>
    );
  }

  it("shows a toast via useToast", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Complete" }));
    expect(await screen.findAllByText("+20 pts")).not.toHaveLength(0);
  });

  it("throws outside the provider", () => {
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
  });
});
