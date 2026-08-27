# Запись встреч — серверная, через LiveKit Egress, audio-only

Запись делает `livekit-egress`: audio-only RoomComposite в MP4, файл в docker-volume, старт/стоп — кнопкой через Egress API из Go-бэкенда. Отклонена клиентская запись через MediaRecorder: файл умер бы вместе с уходом записывающего. Аудио без видео: голосовой хаб, и audio-only egress не запускает Chrome (0.5 CPU, без `--cap-add=SYS_ADMIN`). Композит с видео/экраном — отдельный эпик.
