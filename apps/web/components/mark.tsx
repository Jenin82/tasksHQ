// design.md: the mark is angular and precise, never rounded. The app's T, set
// in square dots — the one mark, wherever the app signs itself.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M1 1h4v4H1zM6 1h4v4H6zM11 1h4v4h-4zM6 6h4v4H6zM6 11h4v4H6z" />
    </svg>
  );
}
