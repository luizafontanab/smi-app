// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ApproveBookingFields } from "@/components/console/ApproveBookingFields";

// "Approve & schedule" used to show whatever the price, though a priced run
// with payments on is held for payment, not scheduled.
describe("ApproveBookingFields", () => {
  it("unpriced: approve & schedule", () => {
    render(<ApproveBookingFields defaultPounds="" pricedHolds />);
    expect(screen.getByRole("button")).toHaveTextContent("Approve & schedule");
  });

  it("priced with payments on: says it sends the invoice and holds the run", () => {
    render(<ApproveBookingFields defaultPounds="650.00" pricedHolds />);
    expect(screen.getByRole("button")).toHaveTextContent("Approve & send the invoice");
    expect(screen.getByRole("button")).toHaveAccessibleDescription(/stays off the site until they pay/);
  });

  it("priced with payments off: schedules and invoices by hand", () => {
    render(<ApproveBookingFields defaultPounds="650" pricedHolds={false} />);
    expect(screen.getByRole("button")).toHaveTextContent("Approve, schedule & invoice");
  });

  it("follows the price as it's typed", () => {
    render(<ApproveBookingFields defaultPounds="650" pricedHolds />);
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "" } });
    expect(screen.getByRole("button")).toHaveTextContent("Approve & schedule");
  });

  // A console renewal's draft is Jas's own booking, not a member's request.
  it("says Book on a console draft, with the same outcomes", () => {
    render(<ApproveBookingFields verb="Book" defaultPounds="650" pricedHolds />);
    expect(screen.getByRole("button")).toHaveTextContent("Book & send the invoice");
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "" } });
    expect(screen.getByRole("button")).toHaveTextContent("Book & schedule");
  });
});
