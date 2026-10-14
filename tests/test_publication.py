"""Negative cases for the publication boundary; all inputs are fabricated."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('publication', Path(__file__).resolve().parents[1] / 'scripts/check_publication.py')
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


class PublicationReviewTests(unittest.TestCase):
    def test_secret_and_path_findings_never_echo_values(self):
        token = 'ghp_' + 'A' * 40
        private_path = '/' + 'home' + '/example-person/project/file.js'
        result = publication.review_bytes('src/example.js', (token + '\n' + private_path).encode())
        self.assertEqual({entry['rule'] for entry in result}, {'credential', 'personal_path'})
        self.assertNotIn(token, str(result))
        self.assertNotIn(private_path, str(result))

    def test_private_instruction_and_build_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ('AGENTS' + '.md')).write_text('private rules')
            (root / 'old.xpi').write_bytes(b'old build')
            result = publication.review_source(root)
            self.assertFalse(result['passed'])
            self.assertEqual({entry['rule'] for entry in result['findings']}, {'private_artifact', 'non_source_artifact'})

    def test_library_bindings_and_provider_fixtures_are_rejected(self):
        binding = 'const value = {attachmentKey: "' + 'ABCDEFGH' + '"};'
        self.assertEqual(publication.review_bytes('src/example.js', binding.encode())[0]['rule'], 'hardcoded_library_binding')
        fixture = ('openalex:' + 'W' + '1' * 10).encode()
        self.assertEqual(publication.review_bytes('tests/fixtures/example.js', fixture)[0]['rule'], 'provider_records_in_fixture')

    def test_symlink_and_archive_traversal_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'README.md').write_text('example')
            (root / 'linked.md').symlink_to(root / 'README.md')
            self.assertEqual(publication.review_source(root)['findings'][0]['rule'], 'symlink')
            package = root / 'example.xpi'
            with ZipFile(package, 'w') as archive:
                archive.writestr('../outside.js', 'private')
            self.assertEqual(publication.review_xpi(package)['findings'][0]['rule'], 'unsafe_archive_path')

    def test_image_text_metadata_requires_review(self):
        import struct
        signature = bytes.fromhex('89504e470d0a1a0a')
        chunk = lambda kind, value: struct.pack('>I', len(value)) + kind + value + b'\0' * 4
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'example.png').write_bytes(signature + chunk(b'tEXt', b'example') + chunk(b'IEND', b''))
            self.assertEqual(publication.review_source(root)['findings'][0]['rule'], 'image_metadata_needs_review')


if __name__ == '__main__':
    unittest.main()
