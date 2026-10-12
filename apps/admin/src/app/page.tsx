import { internalConfig } from "../lib/server-config";
import { AdminApp } from "../components/AdminApp";
export const dynamic = "force-dynamic";
export default function Page() {
  if (!internalConfig()) return <main className="container narrow"><section className="panel"><h1>Администрирование недоступно</h1><p>Обратитесь к ответственному за доступ.</p></section></main>;
  return <AdminApp />;
}
