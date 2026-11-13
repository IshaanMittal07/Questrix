import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Hello({ name }: { name: string }) {
  return <h1>Hello, {name}</h1>;
}

describe("smoke", () => {
  it("renders a component", () => {
    render(<Hello name="Questrix" />);
    expect(
      screen.getByRole("heading", { name: "Hello, Questrix" }),
    ).toBeInTheDocument();
  });
});
