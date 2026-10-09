import io
import unittest
import urllib.error
from types import SimpleNamespace
from unittest.mock import patch

import monitor


class XueqiuFetchTests(unittest.TestCase):
    def setUp(self):
        self.config = monitor.Config(
            xueqiu_url="https://xueqiu.com/P/ZH188094",
            wechat_app_id="test",
            wechat_app_secret="test",
            wechat_to_openids=("test",),
            wechat_template_id="test",
        )
        self.snapshot = ([{"id": 1}], {"Example": 10.0}, "Example Cube")

    def test_login_error_skips_primary_retry_and_delay(self):
        with patch.object(monitor, "fetch_rebalance_records", side_effect=monitor.XueqiuLoginError("login")) as primary, \
                patch.object(monitor, "fetch_analyze_snapshot", return_value=self.snapshot), \
                patch.object(monitor.time, "sleep") as sleep:
            self.assertEqual(monitor.fetch_xueqiu_snapshot(self.config), self.snapshot)
            primary.assert_called_once_with(self.config)
            sleep.assert_not_called()

    def test_network_error_still_waits_and_retries(self):
        records, holdings, name = self.snapshot
        with patch.object(monitor, "fetch_rebalance_records", side_effect=[monitor.MonitorError("timeout"), records]) as primary, \
                patch.object(monitor, "fetch_holdings", return_value=holdings), \
                patch.object(monitor, "fetch_cube_name", return_value=name), \
                patch.object(monitor, "prime_xueqiu_session"), \
                patch.object(monitor.time, "sleep") as sleep, \
                patch.object(monitor, "fetch_analyze_snapshot") as fallback:
            self.assertEqual(monitor.fetch_xueqiu_snapshot(self.config), self.snapshot)
            self.assertEqual(primary.call_count, 2)
            sleep.assert_called_once_with(monitor.XUEQIU_RETRY_SECONDS)
            fallback.assert_not_called()

    def test_holdings_login_error_preserves_priced_records(self):
        priced_records = [{"id": 2, "rebalancing_histories": [{"price": 42.55}]}]
        with patch.object(monitor, "fetch_rebalance_records", return_value=priced_records), \
                patch.object(monitor, "fetch_holdings", side_effect=monitor.XueqiuLoginError("login")), \
                patch.object(monitor, "fetch_analyze_snapshot", return_value=self.snapshot), \
                patch.object(monitor.time, "sleep") as sleep:
            records, holdings, name = monitor.fetch_xueqiu_snapshot(self.config)
            self.assertEqual(records, priced_records)
            self.assertEqual((holdings, name), self.snapshot[1:])
            sleep.assert_not_called()

    def test_failed_fallback_does_not_push_or_save_history(self):
        with patch.object(monitor, "fetch_rebalance_records", side_effect=monitor.XueqiuLoginError("login")), \
                patch.object(monitor, "fetch_analyze_snapshot", side_effect=monitor.MonitorError("unavailable")), \
                patch.object(monitor, "random_delay"), \
                patch.object(monitor, "prime_xueqiu_session"), \
                patch.object(monitor, "push_wechat") as push, \
                patch.object(monitor, "save_history") as save:
            with self.assertRaises(monitor.MonitorError):
                monitor.monitor_config(self.config, {"cubes": {}})
            push.assert_not_called()
            save.assert_not_called()

    def test_curl_http_and_json_login_errors_are_classified(self):
        for status, code in ((400, "400016"), (200, 400016)):
            with self.subTest(status=status), \
                    patch.object(monitor, "curl_requests", SimpleNamespace(request=lambda *args, **kwargs: SimpleNamespace(
                        status_code=status, text=monitor.json.dumps({"error_code": code})
                    ))):
                with self.assertRaises(monitor.XueqiuLoginError):
                    monitor.request_json(monitor.XUEQIU_HISTORY_API)

    def test_urllib_http_login_error_is_classified(self):
        error = urllib.error.HTTPError(
            monitor.XUEQIU_HISTORY_API, 400, "Bad Request", {}, io.BytesIO(b'{"error_code":"400016"}')
        )
        with patch.object(monitor, "curl_requests", None), patch.object(monitor.OPENER, "open", side_effect=error):
            with self.assertRaises(monitor.XueqiuLoginError):
                monitor.request_json(monitor.XUEQIU_HISTORY_API)

    def test_other_hosts_and_http_errors_keep_normal_error_type(self):
        for url, raw in (
            (monitor.WECHAT_TOKEN_API, '{"error_code":"400016"}'),
            (monitor.XUEQIU_HISTORY_API, '{"error_code":"500"}'),
            (monitor.XUEQIU_HISTORY_API, "Service unavailable"),
        ):
            with self.subTest(url=url, raw=raw), \
                    patch.object(monitor, "curl_requests", SimpleNamespace(request=lambda *args, **kwargs: SimpleNamespace(
                        status_code=503, text=raw
                    ))):
                with self.assertRaises(monitor.MonitorError) as raised:
                    monitor.request_json(url)
                self.assertNotIsInstance(raised.exception, monitor.XueqiuLoginError)


if __name__ == "__main__":
    unittest.main()
