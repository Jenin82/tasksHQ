import { Guide, guideMetadata } from "../guide";
import { sections } from "./content";

export const metadata = guideMetadata("project-settings");

export default function ProjectSettingsPage() {
  return <Guide topic="project-settings" sections={sections} />;
}
