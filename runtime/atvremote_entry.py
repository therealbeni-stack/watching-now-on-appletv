import sys
from pyatv.scripts.atvremote import main
if __name__ == "__main__":
    sys.argv[0] = "atvremote"
    sys.exit(main())
