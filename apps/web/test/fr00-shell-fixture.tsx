/** Browser-only fixture. It is bundled by the evidence script, never a production route. */
import { createRoot } from "react-dom/client";
import { ConsumerShell, type ConsumerShellMode } from "../src/components/consumer/ConsumerShell";
import { ContentContainer, SurfacePanel, FocusedScrollArea, FocusedActions } from "../src/components/consumer/Surfaces";
import { Button } from "../src/components/consumer/Button";

const requestedMode = new URLSearchParams(window.location.search).get("mode");
const mode: ConsumerShellMode = requestedMode === "document" ? "document" : "focused";
const content = Array.from({ length: 24 }, (_, i) => <p key={i}>Строка {i + 1}. Люди. Игра. Больше хороших дней.</p>);
createRoot(document.getElementById("fixture")!).render(
  <ConsumerShell active="none" title={mode === "focused" ? "Сообщения" : "О сервисе"} mode={mode}>
    {mode === "focused" ? <>
      <SurfacePanel><Button href="/games" variant="ghost">← Назад</Button><h1>Сообщения</h1></SurfacePanel>
      <FocusedScrollArea aria-label="Содержание беседы" tabIndex={0}><ContentContainer measure="narrow">{content}</ContentContainer></FocusedScrollArea>
      <FocusedActions><SurfacePanel><label htmlFor="message">Сообщение</label><input id="message" placeholder="Написать сообщение" /><Button disabled>Отправить</Button></SurfacePanel></FocusedActions>
    </> : <SurfacePanel>{content}</SurfacePanel>}
  </ConsumerShell>,
);
