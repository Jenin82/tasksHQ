import { BlockWordmark } from "@/components/block-wordmark";
import { Mark } from "@/components/mark";

export function SiteFooter() {
  return (
    <footer className="px-4 sm:px-6">
      <div className="mx-auto max-w-[1200px] px-6 pt-8 sm:px-10">
        <div className="flex items-center gap-3">
          <Mark className="size-6" />
          <p className="text-[36px] leading-none tracking-[-0.03em]">TasksHQ</p>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          © <span className="numeral">{new Date().getFullYear()}</span> Jenin Joseph and TasksHQ contributors
        </p>
        <div className="mt-8">
          <BlockWordmark />
        </div>
      </div>
    </footer>
  );
}
