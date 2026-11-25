import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSupport } from "@/lib/push/platform";

const client = vi.hoisted(() => ({
  isSubscribed: vi.fn(async () => false),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(async () => true),
  claimSubscription: vi.fn(async () => {}),
  activeRegistration: vi.fn(async () => ({}) as ServiceWorkerRegistration),
}));
vi.mock("@/lib/push/client", () => client);

let support: PushSupport = "supported";
vi.mock("@/lib/push/platform", () => ({ pushSupport: () => support }));

const { EnableNotifications } =
  await import("@/components/push/EnableNotifications");
const { SignOutButton } = await import("@/components/push/SignOutButton");

const KEY = "BPublicKey";
let permission: NotificationPermission = "default";
const requestPermission = vi.fn(async () => "granted");

beforeEach(() => {
  support = "supported";
  permission = "default";
  requestPermission.mockClear();
  client.isSubscribed.mockReset();
  client.isSubscribed.mockResolvedValue(false);
  client.subscribe.mockReset();
  client.unsubscribe.mockReset();
  client.unsubscribe.mockResolvedValue(true);
  vi.stubGlobal("Notification", {
    requestPermission,
    get permission() {
      return permission;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("EnableNotifications", () => {
  it("never asks for permission or subscribes on mount", async () => {
    render(<EnableNotifications publicKey={KEY} />);
    await screen.findByRole("button", { name: "Enable notifications" });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
  });

  it("subscribes only when the button is clicked, then shows on", async () => {
    client.subscribe.mockResolvedValue({ ok: true });
    render(<EnableNotifications publicKey={KEY} />);
    const btn = await screen.findByRole("button", {
      name: "Enable notifications",
    });
    expect(client.subscribe).not.toHaveBeenCalled();
    await userEvent.click(btn);
    expect(client.subscribe).toHaveBeenCalledExactlyOnceWith(KEY);
    expect(
      await screen.findByRole("button", {
        name: "Turn off notifications on this device",
      }),
    ).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Notifications are on for this device.",
    );
  });

  it("shows checking first", () => {
    client.isSubscribed.mockReturnValue(new Promise(() => {}));
    render(<EnableNotifications publicKey={KEY} />);
    expect(screen.getByText("Checking notifications…")).toBeInTheDocument();
  });

  it("disables the button while subscribing", async () => {
    let finish!: (v: unknown) => void;
    client.subscribe.mockReturnValue(new Promise((r) => (finish = r)));
    render(<EnableNotifications publicKey={KEY} />);
    const btn = await screen.findByRole("button", {
      name: "Enable notifications",
    });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    await act(async () => finish({ ok: true }));
    expect(
      await screen.findByRole("button", {
        name: "Turn off notifications on this device",
      }),
    ).toBeEnabled();
  });

  it("shows the install sheet on iPhone outside the installed app", async () => {
    support = "install";
    render(<EnableNotifications publicKey={KEY} />);
    expect(
      await screen.findByText(
        "On iPhone, notifications work once Questrix is on your Home Screen.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enable notifications" }),
    ).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "How to install" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Install Questrix",
    });
    expect(dialog).toHaveTextContent("Add to Home Screen");
    expect(dialog).toHaveTextContent("Needs iOS 16.4 or later.");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("explains an unsupported browser", async () => {
    support = "unsupported";
    render(<EnableNotifications publicKey={KEY} />);
    expect(
      await screen.findByText("This browser doesn't support notifications."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(client.isSubscribed).not.toHaveBeenCalled();
  });

  it("shows the blocked help when permission is already denied", async () => {
    permission = "denied";
    render(<EnableNotifications publicKey={KEY} />);
    expect(
      await screen.findByText(/Notifications are blocked for Questrix/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enable notifications" }),
    ).toBeEnabled();
    expect(client.isSubscribed).not.toHaveBeenCalled();
  });

  it("moves to the denied state when the user refuses on click", async () => {
    client.subscribe.mockResolvedValue({ ok: false, reason: "denied" });
    render(<EnableNotifications publicKey={KEY} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Enable notifications" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /Notifications are blocked for Questrix/,
    );
    // The status message replaces the static note: shown once, not twice.
    expect(screen.getAllByText(/Notifications are blocked/)).toHaveLength(1);
  });

  it("says unavailable without a VAPID public key and has no button", async () => {
    // CI builds with a dummy key in the env; this case has none at all.
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    render(<EnableNotifications publicKey={undefined} />);
    expect(
      await screen.findByText("Notifications are unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("starts on when this device is already subscribed", async () => {
    client.isSubscribed.mockResolvedValue(true);
    render(<EnableNotifications publicKey={KEY} />);
    expect(
      await screen.findByRole("button", {
        name: "Turn off notifications on this device",
      }),
    ).toBeInTheDocument();
  });

  it("turns off and confirms", async () => {
    client.isSubscribed.mockResolvedValue(true);
    render(<EnableNotifications publicKey={KEY} />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Turn off notifications on this device",
      }),
    );
    expect(client.unsubscribe).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("button", { name: "Enable notifications" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Notifications are off for this device.",
    );
  });

  it("warns when the server didn't confirm the turn-off", async () => {
    // On at first; off in the browser after the turn-off.
    client.isSubscribed.mockResolvedValueOnce(true).mockResolvedValue(false);
    client.unsubscribe.mockResolvedValue(false);
    render(<EnableNotifications publicKey={KEY} />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Turn off notifications on this device",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "the server didn't confirm",
    );
  });

  it.each([
    ["too-many", "Notifications are on for 10 devices already."],
    ["failed", "Couldn't turn notifications on. Try again."],
    ["unavailable", "Notifications aren't available right now."],
    // Dismissed isn't blocked: it stays off with a friendly note.
    ["dismissed", "You can turn them on any time."],
    ["rate-limited", "Too many tries. Try again in a little while."],
  ] as const)("shows the %s message and stays off", async (reason, text) => {
    client.subscribe.mockResolvedValue({ ok: false, reason });
    render(<EnableNotifications publicKey={KEY} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Enable notifications" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(
      screen.getByRole("button", { name: "Enable notifications" }),
    ).toBeEnabled();
  });
});

describe("SignOutButton", () => {
  let submit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal("PushManager", class {});
  });

  afterEach(() => {
    submit.mockRestore();
    // @ts-expect-error -- remove the test double from jsdom's navigator.
    delete navigator.serviceWorker;
    vi.useRealTimers();
  });

  it("posts to /auth/signout", () => {
    const { container } = render(<SignOutButton />);
    const form = container.querySelector("form")!;
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(form).toHaveAttribute("method", "post");
  });

  it("unsubscribes this device before submitting", async () => {
    const order: string[] = [];
    client.unsubscribe.mockImplementation(async () => {
      order.push("unsubscribe");
      return true;
    });
    submit.mockImplementation(() => order.push("submit"));
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(order).toEqual(["unsubscribe", "submit"]);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
  });

  it("still submits when unsubscribe reports failure", async () => {
    client.unsubscribe.mockResolvedValue(false);
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("submits after 3 s even if unsubscribe hangs", async () => {
    vi.useFakeTimers();
    client.unsubscribe.mockReturnValue(new Promise(() => {}));
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(client.unsubscribe).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(2999));
    expect(submit).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("skips unsubscribe where push isn't available", async () => {
    vi.unstubAllGlobals();
    // @ts-expect-error -- jsdom has no PushManager by default.
    delete window.PushManager;
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(client.unsubscribe).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
  });
});
