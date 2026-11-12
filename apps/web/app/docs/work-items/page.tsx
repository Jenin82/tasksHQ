import { Guide, guideMetadata } from "../guide";
import { sections } from "./content";

export const metadata = guideMetadata("work-items");

export default function WorkItemsPage() {
  return <Guide topic="work-items" sections={sections} />;
}
