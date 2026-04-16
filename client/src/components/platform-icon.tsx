import { SiInstagram, SiYoutube, SiX, SiFacebook } from "react-icons/si";

type Platform = "Instagram" | "YouTube" | "Twitter" | "Facebook";

const platformIcons: Record<Platform, typeof SiInstagram> = {
  Instagram: SiInstagram,
  YouTube: SiYoutube,
  Twitter: SiX,
  Facebook: SiFacebook,
};

const platformColors: Record<Platform, string> = {
  Instagram: "text-pink-500",
  YouTube: "text-red-500",
  Twitter: "text-foreground",
  Facebook: "text-blue-600",
};

interface PlatformIconProps {
  platform: Platform;
  size?: number;
  className?: string;
}

export function PlatformIcon({ platform, size = 20, className = "" }: PlatformIconProps) {
  const Icon = platformIcons[platform];
  return <Icon size={size} className={`${platformColors[platform]} ${className}`} />;
}
