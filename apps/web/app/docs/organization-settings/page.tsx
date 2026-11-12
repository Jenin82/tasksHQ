import { Guide, guideMetadata } from "../guide";
import { sections } from "./content";

export const metadata = guideMetadata("organization-settings");

export default function OrganizationSettingsPage() {
  return <Guide topic="organization-settings" sections={sections} />;
}
