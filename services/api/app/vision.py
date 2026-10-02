import base64
import io
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from .config import settings


def validate_image(data):
    if len(data) > settings.max_upload_mb * 1024 * 1024: raise ValueError('Image exceeds upload limit')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as picture:
                if picture.format not in {'PNG','JPEG','WEBP','GIF'}: raise ValueError('Unsupported image format')
                if picture.width * picture.height > settings.vision_max_pixels: raise ValueError('Image dimensions exceed safety limit')
                if getattr(picture,'n_frames',1) > 1: raise ValueError('Use a still image instead of an animation')
                mime = Image.MIME[picture.format]
                picture.verify()
                return mime
    except (UnidentifiedImageError, OSError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ValueError('Invalid or oversized image') from None


def vision_part(data):
    validate_image(data)
    with Image.open(io.BytesIO(data)) as image:
        image = ImageOps.exif_transpose(image).convert('RGB')
        image.thumbnail((1024,1024))
        output = io.BytesIO(); image.save(output,format='JPEG',quality=85)
    # Provider receives normalized pixels, never user storage URLs or EXIF metadata.
    return {'type':'input_image','image_url':'data:image/jpeg;base64,'+base64.b64encode(output.getvalue()).decode('ascii'),'detail':'low'}
