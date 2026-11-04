# Публикация

Адрес: https://css.imon.world. Источник: ветка `main` репозитория `IMONsergey/imon-design-library`.

## Как устроено

- DNS обслуживают `ns1.reg.ru` и `ns2.reg.ru`. Поддомен уже разрешается в `94.249.186.240` через существующую общую запись. Остальные записи зоны не менялись.
- Отдельный виртуальный хост nginx обслуживает только `css.imon.world`. HTTP перенаправляется на HTTPS, ACME-проверка остается доступной для продления сертификата.
- Статический сайт: нет базы данных, серверного JavaScript приложения, формы загрузки, открытого API записи или платных сервисов.
- Пользователь `imon-design-library` без входа в систему собирает и публикует релизы. Он не использует GitHub-токен: репозиторий публичный.
- Таймер `imon-design-library.timer` проверяет main примерно раз в 2 минуты. Он скачивает изменения, запрещает откат/перезапись истории, проверяет неизменность опубликованных паков, запускает валидацию, тесты и сборку.
- Только успешная сборка попадает в `releases/<commit>`. Символическая ссылка `current` переключается атомарно. `previous` сохраняет прошлый релиз. Неудачная сборка не заменяет текущий сайт.
- Каталог и исходники отдаются с `no-cache`, чтобы изменения интерфейса и исправления не застревали в кеше. Версии паков при этом остаются неизменными на уровне Git.

## Пути на сервере

| Назначение | Путь |
| --- | --- |
| Только Git-объекты | `/srv/imon-design-library/git` |
| Рабочие каталоги сборок | `/srv/imon-design-library/builds/<commit>` |
| Публичные релизы | `/srv/imon-design-library/releases/<commit>` |
| Текущий / предыдущий релиз | `/srv/imon-design-library/current`, `/srv/imon-design-library/previous` |
| Контроллер публикации, владелец root | `/usr/local/lib/imon-design-library/` |
| Конфигурация nginx | `/etc/nginx/conf.d/css.imon.world.conf` |
| Общие HTTP-заголовки проекта | `/etc/nginx/snippets/imon-design-security.conf` |
| Сертификат | `/etc/letsencrypt/live/css-imon-world/` |

Контроллер устанавливается отдельно от main и сам не обновляет себя. Изменения `deploy/` нужно проверить и установить вручную; обычный импорт паков этого не требует. Это не дает коммиту заменить привилегированную конфигурацию сервера.

## Проверки

```sh
systemctl status imon-design-library.timer
systemctl status imon-design-library.service
journalctl -u imon-design-library.service -n 80 --no-pager
curl -fsS https://css.imon.world/health.json
curl -fsS https://css.imon.world/api/catalog.json
sudo systemctl start imon-design-library.service
```

У успешного oneshot-сервиса нормальное состояние `inactive (dead)` после завершения; результат должен быть `success` и код завершения 0. Работает именно timer.

## Откат

Сначала остановить автопубликацию, иначе следующий тик снова установит main. Затем переключить только проверенную ссылку на предыдущий релиз:

```sh
sudo systemctl stop imon-design-library.timer
sudo -u imon-design-library /usr/bin/flock -n /srv/imon-design-library/deploy.lock /opt/imon-runtime/node/bin/node /usr/local/lib/imon-design-library/update.mjs --rollback
curl -fsS https://css.imon.world/health.json
```

После исправления main включить таймер: `sudo systemctl start imon-design-library.timer`. Старые релизы и сборки автоматически не удаляются. Когда библиотека вырастет, нужно добавить отдельную контролируемую политику хранения с сохранением текущего и предыдущего релизов.

## Границы доступа

Код на main считается доверенным кодом владельца. При импорте непроверенных ассетов нельзя добавлять исполняемые шаги в сборщик, workflow или тесты. Пак не может устанавливать npm-зависимости или запускать свой build-скрипт. HTML-превью не запускается во время сборки.

Статус draft и отсутствие в каталоге не делают коммит приватным. Для закрытых клиентских библиотек нужен отдельный приватный репозиторий и авторизация сайта. В текущем публичном проекте такие материалы запрещены.
