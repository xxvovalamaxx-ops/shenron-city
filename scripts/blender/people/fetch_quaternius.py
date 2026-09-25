"""Fetch the CC0 Quaternius "Ultimate Modular Men / Women" source characters.

The crowd bodies (public/models/people/crowd_*.glb) are rebuilt from these by
build_crowd.py. The raw glTFs are ~3 MB each with embedded buffers, so they
are not committed; this pulls the exact reviewed files from the author's
public Google Drive folders and checks them against the pinned SHA-256s.

    python3 scripts/blender/people/fetch_quaternius.py <out_dir>

Sources (both CC0 1.0, license text inside each folder):
  Ultimate Modular Men   https://quaternius.com/packs/ultimatemodularcharacters.html
                         Drive folder 1USAAquX2JJWuA2m6zol0KUkFe3UkZ8zX
                         (Individual Characters / glTF)
  Ultimate Modular Women https://quaternius.com/packs/ultimatemodularwomen.html
                         Drive folder 1720N9IGyQHXYvtvZJzazhxtTTlz-y2Vf
                         (Individual Characters / glTF)
"""
import hashlib
import os
import subprocess
import sys

FILES = {
    # gender/name: (drive file id, sha256)
    'men/Beach.gltf': ('1IL1YJPJvNkuGnKI69-W-VMBIDCo-u49N',
                       '76e001ea131fd76a1bd938a7862606cb8037f7049b632783580b9bf4da2371a8'),
    'men/Casual_2.gltf': ('1Jn7kULNmrtqP8BUUL19h8MhbdOnwPFhv',
                          '55c654d09a2a5ff6e3bd6158d4a1b462f181cd6f1e12a0f5e9d959f9c3abc438'),
    'men/Casual_Hoodie.gltf': ('1em1So1xwwQNfHJYMvzKcXkZllvtxpKP5',
                               'dd74886c26998a0fa888b4ce557a0932d7d97b0265dd4c763154d081b7a6cb98'),
    'men/Punk.gltf': ('1yHWu5ezXq4dYBcn4sWiNd16YN9fMtXo0',
                      'f9224072f5e6cbb207eca250faa7f1868614a1a984074fe79c7b2862df4feb42'),
    'men/Suit.gltf': ('1NhXHnGU0zK9hBrT5FoZp8nTz_EmvTPg5',
                      '6c89fbb31b96c1a63ad94e3dee0942bd7b34bc789a5d39fd6a6a1738a9214fb3'),
    'men/Worker.gltf': ('14d8n7IDnnlnGt_uiATnNg3uvi_4dyd9V',
                        'e49f8ec0f8a7de72dd26b1c01e6413c9a87a9116eeee21f9364ccd36bc286335'),
    'men/Adventurer.gltf': ('1fzSq1Rr037f7QkfXPWEAzmbLMNx-FpPA',
                            '21f7a61afb6bd6cef6961490c367594e3c2fc01ec1f041662131172ce763063e'),
    'women/Casual.gltf': ('18b3WwlrwrFYWAM7BcnjWeIxKJyxAQiGh',
                          'b0fe6e92219cd71808844a20a1a8b960fd1cf640a6546dc6362b5add6604e87c'),
    'women/Formal.gltf': ('1iayBzVv_zLjuPtaNPouw_auwKlQLLmes',
                          'fdfcf454c4de037d31973eb28d8591bd7763035d49f46b380e63b1c832dc7ddf'),
    'women/Suit.gltf': ('1GjWtofxjmPku25cXJxHrzLLeUbXw7A_s',
                        '937d5c8d08fb5570f6a4e1dd79a3878335444d175aae3b0e9e2babdac36a17f7'),
    'women/Punk.gltf': ('1ITb_iFiroAsmjQI38z_p6nNXinwliVLA',
                        '61cc7f85a8e9b700cdb92ae8ebd6e3bdd1e8a510b57027f6c7d8c2b6ff3b0e0f'),
    'women/Worker.gltf': ('1iwF_fqDErPH9uyol6NmS-MnzGgsZ5ejV',
                          'e2bfc1039f429e870a0119e274c2dd45f6304f00c39f4570dfeb9ed4d97a063d'),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'quaternius'
    for rel, (fid, digest) in FILES.items():
        path = os.path.join(out, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not (os.path.exists(path) and sha256(path) == digest):
            url = ('https://drive.usercontent.google.com/download'
                   f'?id={fid}&export=download&confirm=t')
            subprocess.run(['curl', '-sL', '--max-time', '300', '-o', path, url],
                           check=True)
        got = sha256(path)
        status = 'ok' if got == digest else f'MISMATCH {got}'
        print(f'{rel:28s} {status}')
        if got != digest:
            sys.exit(1)


if __name__ == '__main__':
    main()
