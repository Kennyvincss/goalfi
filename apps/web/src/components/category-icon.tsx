import { Briefcase, Dumbbell, Gamepad2, GraduationCap, Sunrise, Target, Users, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  dumbbell: Dumbbell, "graduation-cap": GraduationCap, target: Target, "gamepad-2": Gamepad2,
  briefcase: Briefcase, sunrise: Sunrise, users: Users,
};

export function CategoryIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  const Icon = (icon && ICONS[icon]) || Target;
  return <Icon className={className} aria-hidden />;
}
