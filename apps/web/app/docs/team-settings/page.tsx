import { Guide, guideMetadata } from "../guide";
import { sections } from "./content";

export const metadata = guideMetadata("team-settings");

export default function TeamSettingsPage() {
  return <Guide topic="team-settings" sections={sections} />;
}
