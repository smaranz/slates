/**
 * The Anterra mark. It follows currentColor so the quiet home footer can
 * tune it with the same light/dark tokens as its links.
 */
export function AnterraLogo({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 248 247"
      fill="none"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M122.903 0C60.354 0 0 51.5956 0 125.147C0 198.698 55.9646 247 118.513 247C130.584 247 140.46 244.804 155.823 239.316V247H248V126.244C248 43.9111 185.451 0 122.903 0ZM80.1062 220.653C46.0885 218.458 35.115 195.404 51.5752 153.689C68.0354 111.973 131.681 43.9111 179.965 39.52C200.814 36.2267 228.248 53.7911 216.177 98.8C201.911 162.471 128.389 220.653 80.1062 220.653Z"
        fill="currentColor"
      />
    </svg>
  );
}
