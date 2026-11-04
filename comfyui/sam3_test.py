"""The sam3 client's bright lines (ADR-0028), against a stub server so no test ever reaches Meta.

Stdlib only, driven by tests/sam3-client.test.ts on the host. The metadata test needs Pillow, so it also runs in the
explore image: docker compose -f comfyui/compose.yml run --rm --no-deps --entrypoint python explore /home/comfy/harness/sam3_test.py
"""
import base64
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import detect

APPROVED = "crew:Beetle/IMG_2931.jpg"
KEY = "test-key-never-in-a-message"
BOX = "<|box;x1=10;y1=20;x2=110;y2=220;w=400;h=300;c=0.875|><|mask;x=0;y=0;c=0.875;data=2,2,!abc|>"


class FakeImage:
    size = (800, 600)

    def crop(self, box):
        return self


def reply(text: str = f"<0f>0{BOX}", model: str = "sam-3.1", status: str = "completed") -> dict:
    return {"model": model, "status": status, "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]}


class Stub(BaseHTTPRequestHandler):
    answers: list = []
    seen: list = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Stub.seen.append({"body": body, "auth": self.headers["Authorization"]})
        code, payload, headers = Stub.answers.pop(0)
        self.send_response(code)
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def log_message(self, *args):
        pass


class Sam3(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        Stub.answers, Stub.seen = [], []
        self.tmp = tempfile.TemporaryDirectory()
        patches = [
            mock.patch.object(detect, "SAM3_URL", f"http://127.0.0.1:{self.server.server_port}/v1/responses"),
            mock.patch.object(detect, "OUT", Path(self.tmp.name)),
            mock.patch.object(detect, "sam3_jpeg", lambda im: b"jpeg-bytes"),
            mock.patch.object(detect, "load", lambda ref: FakeImage()),
            mock.patch.object(detect, "_sam3_pixels", {}),
            mock.patch.object(detect.time, "sleep", lambda s: None),
            mock.patch.dict(os.environ, {"MODEL_API_KEY": KEY}),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_only_approved_photos_reach_the_network(self):
        for ref in ("crew:Plum/downloadfile.jpg", "clean:Plum/downloadfile.jpg", "commons:set1/a-dog.jpg", "shelter:spencer/rex.jpg",
                    "held:run/photos/rex.jpg", "crew:../commons/a-dog.jpg", "crew:Beetle/a-new-file.jpg"):
            with self.assertRaises(SystemExit) as refused:
                detect.sam3_boxes(ref, "a dog")
            self.assertIn("refused", str(refused.exception))
        self.assertEqual(Stub.seen, [])

    def test_downloadfile_is_never_listed_or_cleaned(self):
        self.assertFalse([ref for ref in detect.SAM3_APPROVED | set(detect.SAM3_CLEANED) if "downloadfile" in ref])

    def test_held_originals_stay_off_the_list_and_only_clean_copies_are_read(self):
        originals = ["crew:Plum/PXL_20250423_185424061.PORTRAIT.jpg", "crew:Plum/PXL_20250422_224209397.jpg", "crew:Stacey/IMG_3110.jpg"]
        self.assertFalse([ref for ref in detect.SAM3_APPROVED if ref.startswith("crew:Plum/") or ref == "crew:Stacey/IMG_3110.jpg"])
        read = []
        Stub.answers = [(200, reply(), {}) for _ in originals]
        with mock.patch.object(detect, "load", lambda ref: read.append(ref) or FakeImage()):
            for ref in originals:
                detect.sam3_boxes(ref, "a dog")
        self.assertEqual(read, [ref.replace("crew:", "clean:", 1) for ref in originals])

    def test_every_clean_copy_is_on_the_list_and_cleaned_by_the_tool(self):
        import clean_crew
        self.assertEqual({f"clean:{rel}" for rel in clean_crew.COVERS}, {ref for ref in detect.SAM3_APPROVED if ref.startswith("clean:")})

    def test_a_clean_copy_of_another_size_stops_the_run_before_any_call(self):
        class Other(FakeImage):
            size = (400, 300)
        photos = {"p": ({"species": "dog", "colour": "grey"}, "crew:Plum/PXL_20250422_224209397.jpg", Other())}
        with self.assertRaises(SystemExit) as stopped:
            detect.sam3(photos)
        self.assertIn("nothing sent", str(stopped.exception))
        self.assertEqual(Stub.seen, [])

    def test_one_refused_photo_stops_the_run_before_any_call(self):
        listing = {"species": "dog", "colour": "black"}
        photos = {"good": (listing, APPROVED, FakeImage()), "bad": (listing, "crew:Plum/downloadfile.jpg", FakeImage())}
        with self.assertRaises(SystemExit):
            detect.sam3(photos)
        self.assertEqual(Stub.seen, [])

    def test_the_request_is_one_phrase_unstored_with_confidence(self):
        Stub.answers = [(200, reply(), {})]
        detect.sam3_boxes(APPROVED, "a dog")
        sent = Stub.seen[0]
        self.assertEqual(sent["auth"], f"Bearer {KEY}")
        body = sent["body"]
        self.assertEqual(body["model"], "sam-3.1")
        self.assertIs(body["stream"], False)
        self.assertIs(body["store"], False)
        self.assertEqual(body["metadata"]["include_confidence"], "true")
        text, image = body["input"][0]["content"]
        self.assertEqual(text, {"type": "input_text", "text": "a dog"})
        self.assertEqual(image["image_url"], "data:image/jpeg;base64," + base64.b64encode(b"jpeg-bytes").decode())

    def test_a_reply_from_another_model_is_refused_and_never_cached(self):
        Stub.answers = [(200, reply(model="muse-spark-1.3-contributor"), {})]
        with self.assertRaises(SystemExit) as refused:
            detect.sam3_boxes(APPROVED, "a dog")
        self.assertIn("muse-spark-1.3-contributor", str(refused.exception))
        self.assertEqual(list(Path(self.tmp.name).rglob("*.json")), [])

    def test_transient_errors_retry_and_permanent_ones_do_not(self):
        Stub.answers = [(429, {}, {"Retry-After": "0"}), (503, {}, {}), (200, reply(), {})]
        self.assertEqual(len(detect.sam3_boxes(APPROVED, "a dog")), 1)
        self.assertEqual(len(Stub.seen), 3)
        Stub.answers, Stub.seen = [(400, {"error": {"message": "bad"}}, {})], []
        with self.assertRaises(SystemExit) as failed:
            detect.sam3_boxes(APPROVED, "a cat")
        self.assertEqual(len(Stub.seen), 1)
        self.assertNotIn(KEY, str(failed.exception))

    def test_a_cached_reply_replays_with_no_call_and_no_key(self):
        Stub.answers = [(200, reply(), {})]
        first = detect.sam3_boxes(APPROVED, "a dog")
        with mock.patch.dict(os.environ):
            del os.environ["MODEL_API_KEY"]
            self.assertEqual(detect.sam3_boxes(APPROVED, "a dog"), first)
        self.assertEqual(len(Stub.seen), 1)
        self.assertNotIn(KEY, "".join(p.read_text() for p in Path(self.tmp.name).rglob("*.json")))

    def test_no_key_means_no_call(self):
        with mock.patch.dict(os.environ):
            del os.environ["MODEL_API_KEY"]
            with self.assertRaises(SystemExit):
                detect.sam3_boxes(APPROVED, "a dog")
        self.assertEqual(Stub.seen, [])

    def test_boxes_are_in_the_images_own_pixels(self):
        found = detect.sam3_parse(f"<0f>0{BOX},3{BOX}", (800, 600))
        self.assertEqual(found, [{"box": [20.0, 40.0, 220.0, 440.0], "score": 0.875}] * 2)
        self.assertEqual(detect.sam3_parse("", (800, 600)), [])

    def test_a_mask_payload_cannot_pose_as_a_box(self):
        text = "<0f>0" + BOX.replace("!abc", "!<|box;oops|>")
        self.assertEqual(len(detect.sam3_parse(text, (400, 300))), 1)

    def test_the_four_asks_match_by_iou(self):
        Stub.answers = [
            (200, reply(f"<0f>0{BOX}"), {}),
            (200, reply(f"<0f>0{BOX.replace('c=0.875', 'c=0.5')}"), {}),
            (200, reply(f"<0f>0{BOX.replace('c=0.875', 'c=0.25')}"), {}),
            (200, reply(""), {}),
        ]
        found = detect.sam3_ask(APPROVED, "dog", "black and tan")
        self.assertEqual([s["body"]["input"][0]["content"][0]["text"] for s in Stub.seen],
                         ["a dog", "a black and tan dog", "the head of a dog", "a cat"])
        one = found["species"][0]
        self.assertEqual((one["species"], one["colour_prompt"], one["other"]), (0.875, 0.5, 0.0))
        self.assertEqual(found["heads"][0]["score"], 0.25)

    def test_nothing_on_the_crop_is_a_zero_vote(self):
        Stub.answers = [(200, reply(""), {}) for _ in range(4)]
        crop = mock.MagicMock(width=800, height=600, size=(800, 600))
        crop.crop.return_value = crop
        look = detect.closer_look(crop, {"species": "dog", "colour": "black"}, [10, 10, 100, 100], APPROVED)
        self.assertEqual(look, {"species": 0.0, "colour_prompt": 0.0, "other": 0.0})


class Bare(unittest.TestCase):
    def test_what_is_sent_carries_no_metadata(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow is only in the explore image")
        import io
        source = io.BytesIO()
        exif = Image.Exif()
        exif[0x010F] = "PhoneMaker"
        Image.new("RGB", (64, 48), "red").save(source, "JPEG", exif=exif, comment=b"home address")
        source.seek(0)
        opened = Image.open(source)
        self.assertIn("comment", opened.info)
        jpeg = detect.sam3_jpeg(opened.convert("RGB"))
        at, segments = 2, []
        while jpeg[at] == 0xFF and jpeg[at + 1] != 0xDA:
            segments.append(jpeg[at + 1])
            at += 2 + int.from_bytes(jpeg[at + 2:at + 4], "big")
        self.assertFalse([s for s in segments if s == 0xFE or 0xE1 <= s <= 0xEF], f"metadata segments: {segments}")
        self.assertNotIn(b"PhoneMaker", jpeg)
        self.assertNotIn(b"home address", jpeg)


if __name__ == "__main__":
    unittest.main(verbosity=1)
