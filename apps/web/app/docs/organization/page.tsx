import { Guide, guideMetadata } from "../guide";
import { sections } from "./content";

export const metadata = guideMetadata("organization");

export default function OrganizationPage() {
  return <Guide topic="organization" sections={sections} />;
}
