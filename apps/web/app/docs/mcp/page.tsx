import { Guide, guideMetadata } from "../guide";
import { intro, sections } from "./content";

export const metadata = guideMetadata("mcp");

export default function McpGuide() {
  return <Guide topic="mcp" intro={intro} sections={sections} />;
}
