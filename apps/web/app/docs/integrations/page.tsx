import { Guide, guideMetadata } from "../guide";
import { sections } from "./content";

export const metadata = guideMetadata("integrations");

export default function IntegrationsPage() {
  return <Guide topic="integrations" sections={sections} />;
}
