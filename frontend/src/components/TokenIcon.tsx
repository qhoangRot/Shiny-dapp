export function TokenIcon({ symbol, size = 24 }: { symbol: 'USDC' | 'EURC'; size?: number }) {
  const isUsdc = symbol === 'USDC';
  const bg = isUsdc ? '#2775CA' : '#1B4CE0';
  const label = isUsdc ? '$' : '€';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: '#fff',
        fontSize: size * 0.5,
        fontWeight: 700,
        fontFamily: 'var(--font-body)',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}
