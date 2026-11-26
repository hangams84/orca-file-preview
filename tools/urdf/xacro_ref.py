"""Expands a .xacro file with the reference implementation (ROS 2 `xacro` from PyPI) and prints the
URDF. $(find pkg) has no ROS package index here, so it is mapped to package://pkg, as File Preview does.
   python tools/urdf/xacro_ref.py file.xacro [name:=value ...]"""
import sys
import xacro
import xacro.substitution_args as sa

sa._eval_find = lambda pkg: 'package://' + pkg
mappings = dict(a.split(':=', 1) for a in sys.argv[2:])
doc = xacro.process_file(sys.argv[1], mappings=mappings)
sys.stdout.write(doc.toprettyxml(indent='  '))
