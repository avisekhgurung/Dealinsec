import { SiInstagram, SiYoutube, SiX, SiFacebook, SiLinkedin, SiPinterest, SiSnapchat, SiTiktok, SiSpotify, SiTwitch, SiTelegram, SiDiscord, SiSubstack, SiMedium } from "react-icons/si";
import { Globe } from "lucide-react";

const platformIcons: Record<string, typeof SiInstagram> = {
  Instagram: SiInstagram,
  YouTube: SiYoutube,
  Twitter: SiX,
  "Twitter (X)": SiX,
  X: SiX,
  Facebook: SiFacebook,
  LinkedIn: SiLinkedin,
  Pinterest: SiPinterest,
  Snapchat: SiSnapchat,
  TikTok: SiTiktok,
  Spotify: SiSpotify,
  Twitch: SiTwitch,
  Telegram: SiTelegram,
  Discord: SiDiscord,
  Substack: SiSubstack,
  Medium: SiMedium,
};

const platformColors: Record<string, string> = {
  Instagram: "text-pink-500",
  YouTube: "text-red-500",
  Twitter: "text-foreground",
  "Twitter (X)": "text-foreground",
  X: "text-foreground",
  Facebook: "text-blue-600",
  LinkedIn: "text-blue-700",
  Pinterest: "text-red-600",
  Snapchat: "text-yellow-400",
  TikTok: "text-foreground",
  Spotify: "text-green-500",
  Twitch: "text-purple-500",
  Telegram: "text-blue-400",
  Discord: "text-indigo-500",
  Substack: "text-orange-500",
  Medium: "text-foreground",
};

interface PlatformIconProps {
  platform: string;
  size?: number;
  className?: string;
}

export function PlatformIcon({ platform, size = 20, className = "" }: PlatformIconProps) {
  const Icon = platformIcons[platform] || Globe;
  const color = platformColors[platform] || "text-muted-foreground";
  return <Icon size={size} className={`${color} ${className}`} />;
}
