/**
 * Playful reminder copy (plan §7.2). Pure: the random source is injected so
 * tests are deterministic. Copy never claims a streak the server didn't
 * report as live, and never shows a multiplier (DECISIONS P6).
 */

export type ReminderRow = {
  habit_id: string;
  title: string;
  icon: string | null;
  category: string;
  points: number;
  streak: number;
};

export type PushMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

type Line = (r: { title: string; points: number }) => string;

const BY_CATEGORY: Record<string, Line[]> = {
  health: [
    (r) => `💊 ${r.title} check! Your future self says thanks.`,
    (r) => `🩺 Time for ${r.title}. +${r.points} pts waiting.`,
  ],
  fitness: [
    (r) => `🏃 ${r.title} time. Move it, +${r.points} pts!`,
    (r) => `💪 ${r.title} is calling. Answer it.`,
  ],
  mind: [
    (r) => `🧘 A quiet minute for ${r.title}. +${r.points} pts.`,
    (r) => `🧠 ${r.title} now: your brain will thank you.`,
  ],
  learning: [
    (r) => `📚 ${r.title} starts now. +${r.points} pts on the table.`,
    (r) => `🎓 Level up: ${r.title} time.`,
  ],
  career: [
    (r) => `💻 ${r.title}: ship it. +${r.points} pts.`,
    (r) => `🚀 ${r.title} time. Future you is cheering.`,
  ],
  self_care: [
    (r) => `🧴 ${r.title} time. Your future face says thanks.`,
    (r) => `🛁 Treat yourself: ${r.title}. +${r.points} pts.`,
  ],
  nutrition: [
    (r) => `🥗 ${r.title} time. +${r.points} pts waiting.`,
    (r) => `💧 ${r.title}: fuel up!`,
  ],
  finance: [
    (r) => `💰 ${r.title}: a minute now, a better month later.`,
    (r) => `📈 ${r.title} time. +${r.points} pts.`,
  ],
  social: [
    (r) => `👋 ${r.title}: someone will be glad you did.`,
    (r) => `💬 ${r.title} time. +${r.points} pts.`,
  ],
  other: [
    (r) => `✨ ${r.title} time. +${r.points} pts waiting.`,
    (r) => `✅ Quick one: ${r.title}.`,
  ],
};

function pick<T>(items: T[], random: () => number): T {
  const i = Math.min(items.length - 1, Math.floor(random() * items.length));
  return items[Math.max(0, i)];
}

/** A habit reminder. The tag coalesces repeats of the same habit. */
export function reminderMessage(
  r: ReminderRow,
  random: () => number = Math.random,
): PushMessage {
  const lines = BY_CATEGORY[r.category] ?? BY_CATEGORY.other;
  let body = pick(lines, random)(r);
  // Only a live streak of 2+ is worth naming; 0 means "don't claim one".
  if (r.streak >= 2) body += ` Keep the ${r.streak}-day streak alive 🔥`;
  return {
    title: r.icon ? `${r.icon} ${r.title}` : r.title,
    body,
    url: `/today?habit=${encodeURIComponent(r.habit_id)}`,
    tag: `habit-${r.habit_id}`,
  };
}

/** The 20:00 streak saver. */
export function streakSaverMessage(
  streak: number,
  random: () => number = Math.random,
): PushMessage {
  const body = pick(
    [
      `🔥 Your ${streak}-day streak ends at midnight. One habit keeps it alive.`,
      `⏳ ${streak} days and counting... unless you skip today. One habit saves it.`,
      `🛟 Streak saver: complete any habit today to keep your ${streak}-day run.`,
    ],
    random,
  );
  return { title: "Streak at risk", body, url: "/today", tag: "streak-saver" };
}
