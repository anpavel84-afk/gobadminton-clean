import { notFound } from "next/navigation";
import { documents, LegalPage } from "../../../components/consumer/content/ContentPages";
export default async function DocumentPage({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  if (!Object.hasOwn(documents, document)) notFound();
  return <LegalPage document={document as keyof typeof documents} />;
}
