"""Reference renders of DXF files with ezdxf's drawing add-on (SVG backend, white background,
file colours), for the fidelity comparison in tools/cad2d/fidelity.mjs.

    python tools/cad2d/ezdxf_ref.py --out .orca/fid/ref samples/cad2d/*.dxf
"""
import os
import sys

import ezdxf
from ezdxf.addons.drawing import Frontend, RenderContext, config, layout, svg


def render(path, out):
    doc = ezdxf.readfile(path)  # ASCII and binary DXF
    msp = doc.modelspace()
    ctx = RenderContext(doc)
    backend = svg.SVGBackend()
    cfg = config.Configuration(
        background_policy=config.BackgroundPolicy.WHITE,
        color_policy=config.ColorPolicy.COLOR,
        lineweight_policy=config.LineweightPolicy.ABSOLUTE,
    )
    Frontend(ctx, backend, config=cfg).draw_layout(msp, finalize=True)
    page = layout.Page(0, 0, layout.Units.mm, margins=layout.Margins.all(0))
    s = backend.get_string(page, settings=layout.Settings(fit_page=True, output_coordinate_space=1000000))
    name = os.path.basename(path)
    with open(os.path.join(out, name + '.svg'), 'w', encoding='utf-8') as f:
        f.write(s)


def main():
    args = sys.argv[1:]
    out = '.orca/fid/ref'
    if '--out' in args:
        i = args.index('--out')
        out = args[i + 1]
        del args[i : i + 2]
    os.makedirs(out, exist_ok=True)
    for p in args:
        try:
            render(p, out)
            print('ok', p)
        except Exception as e:  # keep going: the table reports the failure
            print('fail', p, e)


if __name__ == '__main__':
    main()
