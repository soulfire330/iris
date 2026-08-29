// «Вчера, 10:00» — день относительно сегодня (Сегодня/Вчера/дд.мм.гг) и время.
// Общий для таба «Сводки» и раскладки «Все сводки».
export const formatRecDay = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  const day =
    days <= 0
      ? "Сегодня"
      : days === 1
        ? "Вчера"
        : d.toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
          });
  return `${day}, ${time}`;
};
