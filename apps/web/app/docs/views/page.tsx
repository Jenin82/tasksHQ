import { Guide, guideMetadata } from "../guide";
import { sections } from "./content";

export const metadata = guideMetadata("views");

export default function ViewsPage() {
  return <Guide topic="views" sections={sections} />;
}
