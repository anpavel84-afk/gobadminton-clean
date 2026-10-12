import { Suspense } from "react";
import { MessagesPage } from "../../components/consumer/messages/MessagesPage";
export default function Page() { return <Suspense fallback={<p>Загружаем сообщения…</p>}><MessagesPage /></Suspense>; }
