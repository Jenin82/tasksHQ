import { Guide, guideMetadata } from "../guide";
import { sections } from "./content";

export const metadata = guideMetadata("getting-started");

export default function GettingStartedPage() {
  return <Guide topic="getting-started" sections={sections} />;
}
