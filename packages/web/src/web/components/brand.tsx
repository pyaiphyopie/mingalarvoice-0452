import { AudioLines, ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
export function Brand() {
  return (
    <Link href="/" className="brand">
      <AudioLines size={30} />
      <span>
        mingalar<span className="brand-light"> voice</span>
        <small>မြန်မာ့အသံ၊ သင့်စိတ်ကူး</small>
      </span>
    </Link>
  );
}
export function ArrowButton({
  href,
  children,
  light = false,
}: {
  href: string;
  children: React.ReactNode;
  light?: boolean;
}) {
  return (
    <Link href={href} className={`action ${light ? "light" : ""}`}>
      {children}
      <ArrowUpRight size={20} />
    </Link>
  );
}
export function Wave({ small = false }: { small?: boolean }) {
  return (
    <div className={`wave ${small ? "small" : ""}`} aria-hidden="true">
      {Array.from({ length: 49 }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${18 + Math.abs(Math.sin(i * 0.43)) * (85 + Math.sin(i * 0.12) * 70)}px`,
            animationDelay: `${i * 0.03}s`,
          }}
        />
      ))}
    </div>
  );
}
