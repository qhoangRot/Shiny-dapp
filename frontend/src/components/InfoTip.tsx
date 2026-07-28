export function InfoTip({ text }: { text: string }) {
  return (
    <span
      className="info-tip"
      tabIndex={0}
      role="note"
      aria-label={text}
      data-tooltip={text}
    >
      ?
    </span>
  );
}
