# Import inside the existing lienad.ru site, before its fallback handle.
# This fragment deliberately leaves the site's other applications alone.
handle /messenger {
    redir /messenger/ 308
}
handle_path /messenger/* {
    @messenger_service path /signal /directory /ice /health
    handle @messenger_service {
        reverse_proxy messenger-signaling:8787 {
            header_down Cache-Control "no-store"
            header_down Referrer-Policy "no-referrer"
        }
    }
    handle /download/*.apk {
        root * /etc/caddy/sites/messenger-public
        header Content-Type application/vnd.android.package-archive
        header Content-Disposition "attachment; filename=LastCall.apk"
        header Cache-Control "no-store"
        file_server
    }
    handle {
        root * /etc/caddy/sites/messenger-public
        header Cache-Control "no-cache"
        file_server
    }
}
