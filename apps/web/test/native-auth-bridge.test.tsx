// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const wire=vi.hoisted(()=>({command:vi.fn(),me:vi.fn()}));
vi.mock("../src/lib/native-auth",()=>({nativeBridgeCommand:wire.command}));
vi.mock("../src/lib/api-client",()=>({getMe:wire.me}));
vi.mock("../src/components/consumer/players/ProfileComposition",()=>({AuthChooser:({onNativeLogin,onClose}:{onNativeLogin:()=>void;onClose:()=>void})=><div><button onClick={onNativeLogin}>Email success</button><button onClick={onClose}>Close login</button></div>}));
import { NativeAuthBridge } from "../src/components/consumer/players/NativeAuthBridge";
afterEach(()=>{cleanup();vi.resetAllMocks();});
const transactionId="a".repeat(43);
describe("native browser bridge interactions",()=>{
  it("binds on mount/reload but never completes without explicit account confirmation",async()=>{
    wire.command.mockResolvedValue({ok:true,data:{}});wire.me.mockResolvedValue({ok:true,data:{id:"user",displayName:"Test account",csrfToken:"csrf"}});
    const view=render(<NativeAuthBridge transactionId={transactionId}/>);
    await screen.findByText("Test account");expect(wire.command.mock.calls.map(c=>c[1])).toEqual(["bind"]);
    view.unmount();render(<NativeAuthBridge transactionId={transactionId}/>);await screen.findByText("Test account");
    expect(wire.command.mock.calls.map(c=>c[1])).toEqual(["bind","bind"]);
    wire.command.mockImplementation(()=>new Promise(()=>{}));
    fireEvent.click(screen.getByText("Вернуться в приложение"));fireEvent.click(screen.getByText("Вернуться в приложение"));
    expect(wire.command.mock.calls.filter(c=>c[1]==="complete")).toEqual([[transactionId,"complete","csrf"]]);
  });
  it("supports guest login, email completion, reread and explicit cancel without returning credentials",async()=>{
    wire.command.mockResolvedValue({ok:true,data:{}});wire.me.mockResolvedValueOnce({ok:false,status:401}).mockResolvedValue({ok:true,data:{id:"new",displayName:"New account",csrfToken:"new-csrf"}});
    render(<NativeAuthBridge transactionId={transactionId}/>);fireEvent.click(await screen.findByText("Войти"));fireEvent.click(screen.getByText("Email success"));
    await screen.findByText("New account");expect(wire.me).toHaveBeenCalledTimes(2);
    expect(wire.command.mock.calls.some(c=>c[1]==="complete")).toBe(false);
    fireEvent.click(screen.getByText("Отменить вход"));await screen.findByText(/Вход отменён/);
    expect(wire.command).toHaveBeenLastCalledWith(transactionId,"cancel","new-csrf");
  });
  it("offers honest recovery when binding fails and never authenticates on GET",async()=>{
    wire.command.mockResolvedValue({ok:false,status:401});render(<NativeAuthBridge transactionId={transactionId}/>);
    await screen.findByRole("alert");expect(wire.me).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Проверить снова"));await waitFor(()=>expect(wire.command).toHaveBeenCalledTimes(2));
    expect(wire.command.mock.calls.every(c=>c[1]==="bind")).toBe(true);
  });
});
