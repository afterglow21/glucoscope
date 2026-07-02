function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values) {
  const avg = average(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateGMI(avgGlucose) {
  return 3.31 + 0.02392 * avgGlucose;
}

function pct(count, total) {
  return ((count / total) * 100).toFixed(1);
}

function calculateGlucoScore({ tir, tbr, cv, avg }) {
  const tirScore = Math.min(50, Number(tir) * 0.5);

  let tbrScore = 20;
  if (Number(tbr) > 0) tbrScore -= Number(tbr) * 5;
  tbrScore = Math.max(0, tbrScore);

  let cvScore = 15;
  if (Number(cv) > 36) cvScore -= (Number(cv) - 36) * 1.5;
  cvScore = Math.max(0, Math.min(15, cvScore));

  let avgScore = 15;
  if (avg < 80) avgScore -= (80 - avg) * 0.4;
  if (avg > 150) avgScore -= (avg - 150) * 0.25;
  avgScore = Math.max(0, Math.min(15, avgScore));

  const score = Math.round(tirScore + tbrScore + cvScore + avgScore);

  if (score >= 95) {
    return {
      score,
      rank: "Excellent",
      emoji: "🏆",
      message: "今日はかなり安定しています。"
    };
  }

  if (score >= 85) {
    return {
      score,
      rank: "Great",
      emoji: "😊",
      message: "今日は良い流れです。"
    };
  }

  if (score >= 70) {
    return {
      score,
      rank: "Good",
      emoji: "🙂",
      message: "今日はまずまず安定しています。"
    };
  }

  if (score >= 50) {
    return {
      score,
      rank: "Fair",
      emoji: "😌",
      message: "今日は少し整えどころがあります。"
    };
  }

  return {
    score,
    rank: "Tomorrow is another day",
    emoji: "💙",
    message: "今日は無理せず、明日に整えていきましょう。"
  };
}